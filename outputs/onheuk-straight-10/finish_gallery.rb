require 'json'
module OnheukStraightFinish
  ROOT = '/Users/changseok/editor/outputs/onheuk-straight-10'
  def self.camera(view, bounds, gallery=false)
    center=bounds.center
    span=[bounds.width,bounds.height,bounds.depth].max
    distance=[span*2.0,1000.mm].max
    eye=center+Geom::Vector3d.new(distance,-distance,distance*0.8)
    view.camera=Sketchup::Camera.new(eye,center,[0,0,1],false)
    view.camera.height=[span*(gallery ? 0.9 : 1.6),450.mm].max
    view.refresh
  end
  def self.run
    m=Sketchup.active_model
    raise 'Wrong file' unless File.basename(m.path)=='onheuk-straight-10-gallery.skp'
    cat=JSON.parse(File.read(File.join(ROOT,'catalog.json')))['products']
    groups=m.entities.grep(Sketchup::Group).sort_by(&:name)
    raise 'Expected ten products' unless groups.length==10
    report=groups.zip(cat).map do |g,p|
      b=g.definition.bounds
      size=[b.width.to_mm,b.height.to_mm,b.depth.to_mm]
      raise "Bounds #{g.name}" unless size.zip(p['size_mm']).all?{|a,v|(a-v).abs<0.01}
      parts=g.entities.grep(Sketchup::Group)
      raise "Part count #{g.name}" unless parts.length==p['parts'].length
      results=parts.map do |part|
        edges=part.entities.grep(Sketchup::Edge)
        r={name:part.name,solid:part.manifold?,volume_mm3:part.volume*25.4**3,curve_count:edges.count{|e|e.curve}}
        raise "Invalid part #{g.name}/#{part.name}" unless r[:solid] && r[:volume_mm3]>0 && r[:curve_count]==0
        r
      end
      g.set_attribute('Onheuk','Source',p['source'])
      g.set_attribute('Onheuk','DimensionsStatus',p['dimensions_status'])
      {name:g.name,dimensions_mm:size,parts:results}
    end
    m.start_operation('오늑 제품별 장면과 치수',true)
    begin
      m.options['UnitsOptions']['LengthUnit']=2
      m.options['UnitsOptions']['LengthFormat']=0
      m.options['UnitsOptions']['LengthPrecision']=0
      m.rendering_options['DisplaySketchAxes']=false
      m.rendering_options['DrawGround']=false
      m.rendering_options['DrawHorizon']=false
      m.rendering_options['DrawSilhouettes']=false
      m.rendering_options['DrawLineEnds']=false
      m.rendering_options['EdgeDisplayMode']=1
      m.rendering_options['BackgroundColor']=Sketchup::Color.new(250,250,247)
      m.shadow_info['DisplayShadows']=false
      m.entities.grep(Sketchup::Text).each(&:erase!)
      labels=[]
      groups.zip(cat).each do |g,p|
        b=g.bounds
        text=m.entities.add_text("#{g.name}\n#{p['size_mm'].join(' × ')} mm · #{p['thickness_mm']}T",b.min+Geom::Vector3d.new(0,-350.mm,0))
        labels<<text
      end
      m.pages.to_a.each{|page|m.pages.erase(page)}
      groups.each{|g|g.hidden=false};labels.each{|t|t.hidden=false}
      camera(m.active_view,m.bounds,true)
      overview=m.pages.add('00 전체 10개',PAGE_USE_ALL)
      overview.transition_time=0
      groups.each_with_index do |g,i|
        groups.each{|other|other.hidden=(other!=g)}
        labels.each_with_index{|t,j|t.hidden=(j!=i)}
        camera(m.active_view,g.bounds)
        page=m.pages.add(g.name,PAGE_USE_ALL)
        page.transition_time=0
        m.active_view.write_image(filename:File.join(ROOT,"preview-#{'%02d'%(i+1)}.png"),width:1000,height:850,antialias:true,transparent:false)
      end
      groups.each{|g|g.hidden=false};labels.each{|t|t.hidden=false}
      camera(m.active_view,m.bounds,true)
      m.pages.selected_page=overview
      m.active_view.refresh
      m.commit_operation
    rescue Exception
      m.abort_operation
      raise
    end
    raise 'Save failed' unless m.save
    m.active_view.write_image(filename:File.join(ROOT,'gallery-preview.png'),width:1800,height:1200,antialias:true,transparent:false)
    report={path:m.path,product_count:groups.length,part_count:report.sum{|r|r[:parts].length},all_solid:true,all_straight:true,scenes:m.pages.map(&:name),products:report}
    File.write(File.join(ROOT,'runtime-verification.json'),JSON.pretty_generate(report))
    puts "ONHEUK COMPLETE: #{report[:product_count]} products / #{report[:part_count]} solid straight parts / #{report[:scenes].length} scenes"
    true
  end
end
OnheukStraightFinish.run
